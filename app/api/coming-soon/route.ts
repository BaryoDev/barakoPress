import { createPreviewKeyRoute } from "barakopress";
import { config } from "@/press.config";

export const GET = createPreviewKeyRoute(config);
