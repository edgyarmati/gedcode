import { describe, expect, it } from "vitest";

import {
  deriveAuthClientMetadata,
  signPayload,
  timingSafeEqualBase64Url,
  base64UrlEncode,
  base64UrlDecodeUtf8,
} from "./utils.ts";

describe("deriveAuthClientMetadata", () => {
  it("labels Electron user agents as Electron instead of Chrome", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) t3code/0.0.15 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });
});

// RFC 4231 and independently calculated Python hashlib/hmac known answers.
const hmacVectors = [
  {
    name: "RFC 4231 case 1",
    payload: "Hi There",
    keyHex: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b",
    signature: "sDRMYdjbOFNcqK_OrwvxK4gdwgDJgz2nJuk3bC4yz_c",
  },
  {
    name: "RFC 4231 case 2",
    payload: "what do ya want for nothing?",
    keyHex: "4a656665",
    signature: "W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM",
  },
  {
    name: "RFC 4231 case 6",
    payload: "Test Using Larger Than Block-Size Key - Hash Key First",
    keyHex:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    signature: "YOQxWR7gtn8Niiaqy_W3f44LxiE3KMUUBUYEDw7jf1Q",
  },
  {
    name: "64-byte key / Unicode and NUL",
    payload: "\u00e9\u0000\ud83d\ude00",
    keyHex:
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
    signature: "_G1ZArlLVZm49ORoE13AEflWNfBZD0vndd_ACqGeBf4",
  },
  {
    name: "65-byte key",
    payload: "payload",
    keyHex:
      "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
    signature: "x8Hr4cud6wpGpJMqSufDwhXg79RMrzvuaU3p4QRQm1M",
  },
] as const;
describe("native authentication byte compatibility", () => {
  for (const vector of hmacVectors) {
    it(`preserves ${vector.name}`, () => {
      const key = Buffer.from(vector.keyHex, "hex");
      const backing = Buffer.concat([Buffer.from([0xff, 0xfe]), key, Buffer.from([0xfd])]);
      const view = new Uint8Array(backing.buffer, backing.byteOffset + 2, key.byteLength);
      expect(signPayload(vector.payload, view)).toBe(vector.signature);
      expect(signPayload(vector.payload, key)).toBe(vector.signature);
    });
  }
  it("preserves UTF-8 and base64url wire bytes", () => {
    expect(base64UrlEncode("é\0😀")).toBe("w6kA8J-YgA");
    expect(base64UrlDecodeUtf8("w6kA8J-YgA")).toBe("é\0😀");
    expect(base64UrlEncode("\ud800")).toBe("77-9");
    expect(base64UrlEncode(Uint8Array.from([0, 255, 128, 127]).subarray(1, 3))).toBe("_4A");
  });
  it("compares decoded bytes and rejects unequal decoded lengths", () => {
    const signature = hmacVectors[0].signature;
    const bytes = Buffer.from(signature, "base64url");
    expect(timingSafeEqualBase64Url(signature, signature)).toBe(true);
    expect(timingSafeEqualBase64Url(signature, `${signature}=`)).toBe(true);
    expect(timingSafeEqualBase64Url(signature, bytes.toString("base64"))).toBe(true);
    for (const index of [0, 15, 31]) {
      const changed = Buffer.from(bytes);
      changed[index] = changed[index]! ^ 1;
      expect(timingSafeEqualBase64Url(signature, changed.toString("base64url"))).toBe(false);
    }
    expect(timingSafeEqualBase64Url(signature, bytes.subarray(1).toString("base64url"))).toBe(
      false,
    );
    expect(
      timingSafeEqualBase64Url(
        signature,
        Buffer.concat([bytes, Buffer.from([0])]).toString("base64url"),
      ),
    ).toBe(false);
    expect(timingSafeEqualBase64Url(signature, "!")).toBe(false);
    // Characterizes Buffer decoding only, not authorization of malformed/empty tokens.
    expect(timingSafeEqualBase64Url("", "!")).toBe(true);
  });
});
