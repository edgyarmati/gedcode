import { assert, it } from "@effect/vitest";
import {
  MACOS_MANAGED_PREFERENCES_DOMAIN,
  WINDOWS_POLICY_GROUPS,
  WINDOWS_POLICY_LISTS,
  WINDOWS_POLICY_VALUES,
} from "@t3tools/shared/managedPolicyFile";

import { macosProfile, windowsAdmx } from "./policyTemplates.ts";

it("installs the profile and template under GedCode's names, where its reader looks", () => {
  const profile = macosProfile(
    { schemaVersion: 1, organization: "Example Corp" },
    { profile: "profile-uuid", payload: "payload-uuid" },
  );
  assert.equal(profile._tag, "Valid");
  const xml = profile._tag === "Valid" ? profile.profile : "";
  assert.include(xml, `<string>${MACOS_MANAGED_PREFERENCES_DOMAIN}</string>`);
  assert.notInclude(xml, "t3tools");
  assert.include(windowsAdmx(), '<target prefix="gedcode" namespace="GedCode.Policies.GedCode" />');
});

it("gives every registry value the Windows reader accepts a Group Policy control", () => {
  const admx = windowsAdmx();
  for (const name of Object.keys(WINDOWS_POLICY_VALUES)) {
    assert.include(admx, `valueName="${name}"`);
  }
  for (const key of Object.keys(WINDOWS_POLICY_LISTS)) {
    assert.include(admx, `key="SOFTWARE\\Policies\\GedCode\\GedCode\\${key}"`);
  }
  for (const name of Object.keys(WINDOWS_POLICY_GROUPS)) {
    assert.include(admx, `valueName="${name}"`);
  }
});

it("refuses a profile for a policy with a null value, which a plist cannot hold", () => {
  const profile = macosProfile(
    {
      schemaVersion: 1,
      organization: "Example Corp",
      settings: { defaultModelSelection: { value: null, locked: true } },
    },
    { profile: "profile-uuid", payload: "payload-uuid" },
  );
  assert.deepStrictEqual(profile, {
    _tag: "Invalid",
    reason:
      "settings.defaultModelSelection is null, which a configuration profile cannot hold; deploy this policy as a file.",
  });
});
