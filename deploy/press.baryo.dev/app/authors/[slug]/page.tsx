import { createArchive, createCollectionMetadata } from "barakopress";
import { config } from "@/press.config";

export default createArchive(config, "author");
export const generateMetadata = createCollectionMetadata(config, "author");
export const revalidate = 300;
