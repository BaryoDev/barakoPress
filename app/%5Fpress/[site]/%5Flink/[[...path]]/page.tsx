import { createSharedLinkPage, sharedLinkMetadata } from "barakopress";
import { blocks, config } from "@/press.config";

/*
 * What a link to one entry or one page opens. It reads the link's cookie on every request, so this
 * route has no generateStaticParams and is never kept.
 */
export default createSharedLinkPage(config, blocks);
export const metadata = sharedLinkMetadata;
