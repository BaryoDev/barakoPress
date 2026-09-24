import { createBlockSchemaPreflight, createBlockSchemaRoute } from "barakopress";
import { blocks, config } from "@/press.config";

export const GET = createBlockSchemaRoute(config, blocks);
export const OPTIONS = createBlockSchemaPreflight();
