import { createArchive } from "barakopress";
import { config } from "@/press.config";

export default createArchive(config, "author");
export const revalidate = 300;
