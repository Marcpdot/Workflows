import { runTensorSmoke } from "@workflows/knowledge";

runTensorSmoke().catch((error) => {
  console.error(error);
  process.exit(1);
});
