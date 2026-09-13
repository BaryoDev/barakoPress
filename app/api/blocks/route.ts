import { createBlockSchemaRoute } from "barakopress";
import { blocks } from "@/press.config";

export const GET = createBlockSchemaRoute(blocks);
