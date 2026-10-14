// Makes the key pair that signs the agent's credential. Run it once:
//   pnpm agent:keys
// It prints two lines and writes nothing. Where each one goes:
//   AGENT_PRIVATE_KEY=...   -> .env.local (this application's server only)
//   AGENT_JWKS_URI=...      -> the Convex deployment:
//                              npx convex env set AGENT_JWKS_URI "<value>"
// The private key never goes to Convex, the agent process or the browser.

import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const pem = privateKey.export({ type: "pkcs8", format: "pem" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "agent-1", alg: "RS256", use: "sig" };
const jwks = Buffer.from(JSON.stringify({ keys: [jwk] })).toString("base64");

console.log(`AGENT_PRIVATE_KEY=${Buffer.from(pem).toString("base64")}`);
console.log(`AGENT_JWKS_URI=data:text/plain;charset=utf-8;base64,${jwks}`);
