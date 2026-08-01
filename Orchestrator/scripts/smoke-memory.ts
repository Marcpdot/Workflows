import { existsSync, rmSync } from "node:fs";
import { createMemory } from "@workflows/memory";

const path = "./data/_smoke_memory.db";
if (existsSync(path)) rmSync(path);

const m = createMemory({ dbPath: path, defaultLimit: 10 });
await m.add("s1", { role: "user", content: "Hei, jeg heter Ada" });
await m.add("s1", { role: "assistant", content: "Hei Ada!" });
await m.add("s1", { role: "user", content: "Hva heter jeg?" });

const h = await m.getHistory("s1");
console.log("count", h.length);
console.log(JSON.stringify(h, null, 2));
m.close();

const m2 = createMemory({ dbPath: path });
const h2 = await m2.getHistory("s1");
console.log("after restart count", h2.length);
console.log("last", h2[h2.length - 1]);
await m2.clear("s1");
console.log("after clear", (await m2.getHistory("s1")).length);
m2.close();
console.log("OK");
