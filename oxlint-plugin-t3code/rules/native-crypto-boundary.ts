import { isBuiltin } from "node:module";
import { defineRule, type ESTree, type SourceCode, type Variable } from "@oxlint/plugins";
import * as Option from "effect/Option";

import inventory from "../native-crypto-policy.json" with { type: "json" };
import { getPropertyName, unwrapExpression } from "../utils.ts";

const directive = ["// @effect", "diagnostics-next-line nodeBuiltinImport:off"].join("-");
type CryptoEntry = { module: string; import: string; operations: string[]; exception: string };
type LegacyEntry = { directive: string; line: number; nativeImports: string[] };
const cryptoImports: Readonly<Record<string, CryptoEntry>> = inventory.cryptoImports;
const legacyDirectives: Readonly<Record<string, LegacyEntry>> = inventory.legacyDirectives;
const isCrypto = (value: unknown) => value === "node:crypto" || value === "crypto";
const compact = (value: string) =>
  value.replace(/\s+/g, "").replace(directive.replace(/\s+/g, ""), "");

const processLoaders = new Set(["getBuiltinModule", "binding", "_linkedBinding"]);
const isProcess = (value: unknown) => value === "node:process" || value === "process";
type NativeObject = "process" | "module" | "globalThis" | "require";

// Share lexical provenance across member access and destructuring checks. An identifier's
// spelling is meaningful only when it is an unshadowed global. Follow initializer aliases,
// not arbitrary runtime data flow; the visited bindings also terminate cyclic aliases.
const createNativeObjectClassifier = (
  source: SourceCode,
  processImports: ReadonlyArray<ESTree.ImportDeclaration>,
  declarations: ReadonlyArray<ESTree.VariableDeclarator>,
) => {
  const references = new Map<object, Variable | null>();
  const importedObjects = new Set<Variable>();
  const initializers = new Map<Variable, { expression: unknown; properties: string[] }>();
  const project = (object: Option.Option<NativeObject>, property: string) => {
    if (Option.contains(object, "globalThis")) {
      switch (property) {
        case "process":
        case "module":
        case "require":
        case "globalThis":
          return Option.some<NativeObject>(property);
      }
    }
    return Option.contains(object, "process") && property === "default"
      ? Option.some<NativeObject>("process")
      : Option.none<NativeObject>();
  };
  for (const scope of source.scopeManager.scopes) {
    for (const ref of scope.references) references.set(ref.identifier, ref.resolved);
  }
  for (const node of processImports) {
    for (const variable of source.getDeclaredVariables(node)) {
      const specifier = node.specifiers.find((s) => s.local.name === variable.name);
      if (
        specifier &&
        (specifier.type !== "ImportSpecifier" ||
          Option.contains(getPropertyName(specifier.imported), "default"))
      )
        importedObjects.add(variable);
    }
  }
  for (const node of declarations) {
    const variables = source.getDeclaredVariables(node);
    const bind = (pattern: ESTree.Node, properties: string[]) => {
      if (pattern.type === "Identifier") {
        const variable = variables.find((candidate) => candidate.name === pattern.name);
        if (variable) initializers.set(variable, { expression: node.init, properties });
      } else if (pattern.type === "ObjectPattern") {
        for (const property of pattern.properties) {
          if (
            property.type !== "Property" ||
            (property.computed && property.key.type !== "Literal")
          )
            continue;
          const key = getPropertyName(property.key);
          if (Option.isSome(key)) bind(property.value, [...properties, key.value]);
        }
      } else if (pattern.type === "AssignmentPattern") {
        // A default cannot replace a present native global; retain its provenance.
        bind(pattern.left, properties);
      }
    };
    bind(node.id, []);
  }
  const classify = (input: unknown, seen = new Set<Variable>()): Option.Option<NativeObject> => {
    const expression = unwrapExpression(input);
    if (Option.isNone(expression)) return Option.none();
    const node = expression.value;
    if (node.type === "Identifier") {
      const variable = references.get(node);
      if (variable === null || (variable && variable.defs.length === 0)) {
        switch (node.name) {
          case "process":
          case "module":
          case "globalThis":
          case "require":
            return Option.some(node.name);
        }
      }
      if (!variable || seen.has(variable)) return Option.none();
      if (importedObjects.has(variable)) return Option.some("process");
      const initializer = initializers.get(variable);
      if (!initializer) return Option.none();
      return initializer.properties.reduce(
        project,
        classify(initializer.expression, new Set(seen).add(variable)),
      );
    }
    if (node.type === "MemberExpression" && (!node.computed || node.property.type === "Literal")) {
      const property = getPropertyName(node.property);
      if (Option.isSome(property)) return project(classify(node.object, seen), property.value);
    }
    return Option.none();
  };
  return classify;
};

// This is an architectural review boundary, not a sandbox for hostile JavaScript. Use Oxlint's
// parser and lexical scopes, never source regexes to recognize imports or namespace references.
export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Freeze reviewed native crypto imports and diagnostic exceptions." },
  },
  createOnce(context) {
    let imports: ESTree.ImportDeclaration[] = [];
    let moduleImports: ESTree.ImportDeclaration[] = [];
    let processImports: ESTree.ImportDeclaration[] = [];
    let members: ESTree.MemberExpression[] = [];
    let declarations: ESTree.VariableDeclarator[] = [];
    const report = (node: ESTree.Node | ESTree.Comment, message: string) =>
      context.report({ node, message: `Native crypto boundary: ${message}` });
    const checkLoader = (node: ESTree.Node, source: unknown) => {
      const expression = unwrapExpression(source);
      if (
        Option.isNone(expression) ||
        expression.value.type !== "Literal" ||
        typeof expression.value.value !== "string" ||
        isCrypto(expression.value.value) ||
        expression.value.value === "node:module" ||
        expression.value.value === "module"
      ) {
        report(
          node,
          "loaders must use literal non-crypto modules; crypto requires an inventoried static import.",
        );
      }
    };
    return {
      before() {
        imports = [];
        moduleImports = [];
        processImports = [];
        members = [];
        declarations = [];
      },
      ImportDeclaration(node) {
        if (isCrypto(node.source.value)) imports.push(node);
        if (isProcess(node.source.value)) {
          processImports.push(node);
          for (const specifier of node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              Option.exists(getPropertyName(specifier.imported), (name) => processLoaders.has(name))
            )
              report(specifier, "alternate native module loaders are not approved.");
          }
        }
        if (node.source.value === "node:module" || node.source.value === "module")
          moduleImports.push(node);
      },
      ExportNamedDeclaration(node) {
        if (
          node.source &&
          (isCrypto(node.source.value) ||
            node.source.value === "node:module" ||
            node.source.value === "module")
        )
          report(node, "crypto re-exports are not approved.");
      },
      ExportAllDeclaration(node) {
        if (
          isCrypto(node.source.value) ||
          node.source.value === "node:module" ||
          node.source.value === "module"
        )
          report(node, "crypto/loader re-exports are not approved.");
      },
      ImportExpression(node) {
        checkLoader(node, node.source);
      },
      TSImportType(node) {
        checkLoader(node, node.source);
      },
      TSExternalModuleReference(node) {
        checkLoader(node, node.expression);
      },
      MemberExpression(node) {
        members.push(node);
      },
      VariableDeclarator(node) {
        declarations.push(node);
      },
      "Program:exit"(program) {
        const source = context.sourceCode;
        const classify = createNativeObjectClassifier(source, processImports, declarations);
        for (const node of members) {
          const object = classify(node.object);
          const property = getPropertyName(node.property);
          if (
            (Option.contains(object, "process") && node.computed) ||
            (Option.contains(object, "module") &&
              (node.computed || Option.contains(property, "require")))
          )
            report(node, "computed process/module loaders are not approved.");
          if (
            Option.contains(object, "process") &&
            Option.exists(property, (name) => processLoaders.has(name))
          )
            report(node, "alternate native module loaders are not approved.");
        }
        for (const node of declarations) {
          if (
            node.id.type === "ObjectPattern" &&
            Option.exists(
              classify(node.init),
              (object) => object === "process" || object === "module",
            )
          )
            report(node, "destructured process/module capabilities can conceal a native loader.");
        }
        const filename = context.filename.replace(/\\/g, "/");
        const root = context.cwd.replace(/\\/g, "/").replace(/\/$/, "");
        // Relative to the actual project root, not a suffix match (copied paths are unauthorized).
        const path = filename.startsWith(`${root}/`) ? filename.slice(root.length + 1) : filename;
        const approved = cryptoImports[path];
        const legacy = legacyDirectives[path];
        const comments = source.getAllComments();
        const policyComments = comments.filter(
          (comment) =>
            /@effect-diagnostics\b/.test(comment.value) &&
            /\b(?:nodeBuiltinImport|all)\s*:/.test(comment.value),
        );
        // Follow createRequire through the parser's lexical bindings, including renamed imports.
        // A loader may resolve/load only a literal non-crypto module, and may not escape.
        const checkLoaderReference = (id: Extract<ESTree.Node, { type: "Identifier" }>) => {
          let target: ESTree.Node = id;
          if (
            id.parent.type === "MemberExpression" &&
            id.parent.object === id &&
            !id.parent.computed &&
            id.parent.property.type === "Identifier" &&
            id.parent.property.name === "resolve"
          )
            target = id.parent;
          if (target.parent?.type === "CallExpression" && target.parent.callee === target) {
            checkLoader(target.parent, target.parent.arguments[0]);
          } else report(id, "native loader aliases/escapes are not approved.");
        };
        for (const scope of source.scopeManager.scopes) {
          for (const ref of scope.references) {
            if (
              ref.identifier.type === "Identifier" &&
              Option.contains(classify(ref.identifier), "require")
            )
              checkLoaderReference(ref.identifier);
          }
        }
        for (const node of moduleImports) {
          if (
            node.specifiers.some(
              (s) =>
                s.type !== "ImportSpecifier" ||
                Option.exists(
                  getPropertyName(s.imported),
                  (name) => name === "Module" || name === "default",
                ),
            )
          ) {
            report(
              node,
              "use explicit named node:module imports; loader namespaces may hide crypto.",
            );
          }
          for (const variable of source.getDeclaredVariables(node)) {
            const specifier = node.specifiers.find((s) => s.local.name === variable.name);
            if (
              specifier?.type !== "ImportSpecifier" ||
              !Option.contains(getPropertyName(specifier.imported), "createRequire")
            )
              continue;
            for (const ref of variable.references) {
              const call = ref.identifier.parent;
              if (
                call.type !== "CallExpression" ||
                call.callee !== ref.identifier ||
                call.parent.type !== "VariableDeclarator" ||
                call.parent.init !== call ||
                call.parent.id.type !== "Identifier"
              ) {
                report(
                  ref.identifier,
                  "createRequire must initialize a non-escaping local loader.",
                );
                continue;
              }
              for (const loader of source.getDeclaredVariables(call.parent)) {
                for (const use of loader.references) {
                  if (use.identifier === call.parent.id && use.init) continue;
                  if (use.identifier.type === "Identifier") checkLoaderReference(use.identifier);
                }
              }
            }
          }
        }
        const permitted = new Set<ESTree.Comment>();
        if (legacy) {
          const actualImports = program.body
            .filter(
              (node) =>
                node.type === "ImportDeclaration" &&
                typeof node.source.value === "string" &&
                (node.source.value.startsWith("node:") || isBuiltin(node.source.value)),
            )
            .map((node) => compact(source.getText(node)));
          if (actualImports.join("\n") !== legacy.nativeImports.join("\n")) {
            report(
              program,
              "native imports under a legacy broad exception changed; separate review required.",
            );
          }
          const old = policyComments.find(
            (comment) =>
              source.getText(comment) === legacy.directive &&
              comment.loc.start.line === legacy.line &&
              comment.loc.start.column === 0,
          );
          if (old) permitted.add(old);
          else
            report(program, "pre-existing exception changed or moved; separate review required.");
        }
        if (approved) {
          if (imports.length !== 1)
            report(program, "expected exactly one inventoried crypto import.");
          for (const node of imports) {
            if (
              node.source.value !== approved.module ||
              compact(source.getText(node)) !== compact(approved.import)
            ) {
              report(node, "module, import form or bindings differ from the exact allowlist.");
            }
            if (approved.exception === "next-line") {
              if (
                program.body.some(
                  (other) =>
                    other !== node &&
                    other.type === "ImportDeclaration" &&
                    other.source.loc.start.line === node.source.loc.start.line,
                )
              ) {
                report(node, "another import shares the excepted module line.");
              }
              const comment = policyComments.find(
                (c) =>
                  source.getText(c) === directive &&
                  c.loc.end.line === node.source.loc.start.line - 1 &&
                  c.loc.start.line === c.loc.end.line &&
                  source.lines[c.loc.start.line - 1]?.trim() === directive &&
                  // No code may share the diagnostic-bearing module line after this import.
                  source.lines[node.source.loc.start.line - 1]
                    ?.trimEnd()
                    .endsWith('"node:crypto";'),
              );
              if (comment) permitted.add(comment);
              else
                report(
                  node,
                  "exact next-line directive must precede the formatted module-specifier line.",
                );
            }
            const used = new Set<string>();
            for (const variable of source.getDeclaredVariables(node)) {
              const specifier = node.specifiers.find((s) => s.local.name === variable.name);
              for (const reference of variable.references) {
                const id = reference.identifier;
                let callTarget: ESTree.Node = id;
                let operation = variable.name;
                if (specifier?.type === "ImportNamespaceSpecifier") {
                  const parent = id.parent;
                  if (
                    parent.type !== "MemberExpression" ||
                    parent.object !== id ||
                    parent.computed ||
                    parent.property.type !== "Identifier"
                  ) {
                    report(id, "namespace must not escape or use computed/aliased operations.");
                    continue;
                  }
                  operation = parent.property.name;
                  callTarget = parent;
                }
                used.add(operation);
                if (
                  !approved.operations.includes(operation) ||
                  callTarget.parent.type !== "CallExpression" ||
                  callTarget.parent.callee !== callTarget ||
                  callTarget.parent.optional
                ) {
                  report(id, "only direct calls to inventoried operations are permitted.");
                }
              }
            }
            if ([...used].toSorted().join(",") !== approved.operations.join(",")) {
              report(node, "used operations differ from the exact allowlist.");
            }
          }
          for (const comment of comments) {
            if (/@ts-(?:nocheck|ignore)/.test(comment.value))
              report(comment, "TypeScript blanket suppression is not approved here.");
          }
        } else {
          for (const node of imports)
            report(node, "crypto import is not inventoried for this exact file.");
        }
        for (const comment of policyComments) {
          if (!permitted.has(comment))
            report(comment, "new, copied, moved or broadened diagnostic exception.");
        }
      },
    };
  },
});
