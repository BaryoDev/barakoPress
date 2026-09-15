import { createPage, createPageMetadata } from "barakopress";
import { blocks, config } from "@/press.config";

export default createPage(config, blocks);
export const generateMetadata = createPageMetadata(config);
export const revalidate = 300;
