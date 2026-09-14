import { createSiteLayout, createSiteMetadata } from "barakopress";
import "barakopress/styles.css";

import { config } from "@/press.config";

export default createSiteLayout(config);
export const generateMetadata = createSiteMetadata(config);
