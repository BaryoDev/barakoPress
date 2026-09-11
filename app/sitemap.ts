import { createSitemap } from "barakopress";
import { config } from "@/press.config";

export default createSitemap(config);
export const revalidate = 300;
