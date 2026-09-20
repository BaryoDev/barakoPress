import { createPage, createPageMetadata, createSiteStaticParams } from "barakopress";
import { blocks, config } from "@/press.config";

export default createPage(config, blocks);
export const generateMetadata = createPageMetadata(config);
export const generateStaticParams = createSiteStaticParams();
export const revalidate = 300;
