import { createBlockSchemaPreflight, createBlockSchemaRoute } from "barakopress";
import { blocks } from "@/press.config";

export const GET = createBlockSchemaRoute(blocks);
export const OPTIONS = createBlockSchemaPreflight();
