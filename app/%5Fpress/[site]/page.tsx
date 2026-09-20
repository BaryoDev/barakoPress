import { createHome, createHomeMetadata, createSiteStaticParams } from "barakopress";
import { blocks, config } from "@/press.config";

export default createHome(config, blocks);
export const generateMetadata = createHomeMetadata(config);
export const generateStaticParams = createSiteStaticParams();
export const revalidate = 300;
