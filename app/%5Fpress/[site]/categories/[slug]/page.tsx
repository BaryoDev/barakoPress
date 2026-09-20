import { createArchive, createSiteStaticParams } from "barakopress";
import { config } from "@/press.config";

export default createArchive(config, "category");
export const generateStaticParams = createSiteStaticParams();
export const revalidate = 300;
