# Managed policy

Administrators can set defaults and locks for every user on a machine. GedCode reads the same
policy format as T3 Code, so the
[upstream guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/managed-policy.md)
covers writing one. Read `t3` there as `gedcode`.

GedCode reads its policy from its own locations, so a T3 Code policy on the same machine does not
apply to GedCode, and GedCode's does not apply to T3 Code:

| OS      | Native policy                                                                                  | Policy file                                        |
| ------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| macOS   | Configuration profile for the preference domain `com.gedcode.app`                              | `/Library/Application Support/GedCode/policy.json` |
| Windows | Group Policy template, or a `Policy` JSON value under `HKLM\SOFTWARE\Policies\GedCode\GedCode` | `C:\Program Files\GedCode\policy.json`             |
| Linux   |                                                                                                | `/etc/gedcode/policy.json`                         |

`gedcode policy templates <directory>` writes `macos/gedcode.mobileconfig`,
`windows/gedcode.admx` and `windows/en-US/gedcode.adml` for these locations. To make a macOS
payload by hand, run `plutil -convert xml1 -o com.gedcode.app.plist policy.json`.
