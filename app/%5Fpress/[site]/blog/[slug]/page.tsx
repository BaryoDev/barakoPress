import { createBlogPostPreview, createPostMetadata } from "barakopress";
import { config } from "@/press.config";

/*
 * The preview screen reads `?preview=`, and a route that reads the query is one Next will not keep,
 * so this route has no generateStaticParams and renders per request. A site that would rather have
 * its posts cached takes createBlogPost instead and gives up draft preview.
 */
export default createBlogPostPreview(config);
export const generateMetadata = createPostMetadata(config);
