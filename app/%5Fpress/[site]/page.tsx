import { createBlogIndex, createSiteStaticParams } from "barakopress";
import { config } from "@/press.config";

export default createBlogIndex(config);
export const generateStaticParams = createSiteStaticParams();
export const revalidate = 300;
