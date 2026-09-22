import { createSiteLayout, createSiteMetadata } from "barakopress";
import "barakopress/styles.css";

import { blocks, config } from "@/press.config";

export default createSiteLayout(config, { blocks });
export const generateMetadata = createSiteMetadata(config);
