import { createBlogPostPreview, createPostMetadata } from "barakopress";
import { config } from "@/press.config";

export default createBlogPostPreview(config);
export const generateMetadata = createPostMetadata(config);
