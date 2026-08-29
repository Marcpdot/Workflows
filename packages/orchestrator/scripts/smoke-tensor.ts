import { runTensorSmoke } from "../../knowledge/src/tensor.smoke.ts";

runTensorSmoke().catch((error) => {
  console.error(error);
  process.exit(1);
});
