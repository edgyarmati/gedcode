import { TaskTypeId, type TaskTypeId as TaskTypeIdValue } from "@t3tools/contracts";

import { BUILT_IN_FEATURE_PLAYBOOK_TEXT } from "./builtInPlaybooks.ts";

export interface BuiltInTaskTypePlaybook {
  readonly text: string;
  readonly filePath: string;
}

export interface OrchestrationTaskTypeDefinition {
  readonly id: TaskTypeIdValue;
  readonly playbook: BuiltInTaskTypePlaybook;
}

export class TaskTypeRegistry {
  readonly #definitionsById: ReadonlyMap<string, OrchestrationTaskTypeDefinition>;

  constructor(definitions: ReadonlyArray<OrchestrationTaskTypeDefinition>) {
    const definitionsById = new Map<string, OrchestrationTaskTypeDefinition>();
    for (const definition of definitions) {
      const id = String(definition.id);
      if (definitionsById.has(id)) {
        throw new Error(`Duplicate orchestration task type '${id}'.`);
      }
      definitionsById.set(id, definition);
    }
    this.#definitionsById = definitionsById;
  }

  get(id: string): OrchestrationTaskTypeDefinition | undefined {
    return this.#definitionsById.get(id);
  }

  has(id: string): boolean {
    return this.#definitionsById.has(id);
  }

  ids(): ReadonlyArray<TaskTypeIdValue> {
    return Array.from(this.#definitionsById.values(), (definition) => definition.id);
  }
}

export const defaultTaskTypeRegistry = new TaskTypeRegistry([
  {
    id: TaskTypeId.make("feature"),
    playbook: {
      text: BUILT_IN_FEATURE_PLAYBOOK_TEXT,
      filePath: "/__builtin__/orchestration/playbooks/feature/SKILL.md",
    },
  },
]);
