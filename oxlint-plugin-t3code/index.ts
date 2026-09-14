import { definePlugin } from "@oxlint/plugins";

import noInlineSchemaCompile from "./rules/no-inline-schema-compile.ts";

import nativeCryptoBoundary from "./rules/native-crypto-boundary.ts";

export default definePlugin({
  meta: {
    name: "t3code",
  },
  rules: {
    "no-inline-schema-compile": noInlineSchemaCompile,
    "native-crypto-boundary": nativeCryptoBoundary,
  },
});
