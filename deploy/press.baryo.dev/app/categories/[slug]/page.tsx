import { createArchive } from "barakopress";
import { config } from "@/press.config";

export default createArchive(config, "category");
export const revalidate = 300;
