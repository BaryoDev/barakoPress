import { createBlogIndex } from "barakopress";
import { config } from "@/press.config";

export default createBlogIndex(config);
export const revalidate = 300;
