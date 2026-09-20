import { createBindingReportPreflight, createBindingReportRoute } from "barakopress";
import { blocks, config } from "@/press.config";

export const GET = createBindingReportRoute(config, blocks);
export const OPTIONS = createBindingReportPreflight();
