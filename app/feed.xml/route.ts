import { createFeed } from "barakopress";
import { config } from "@/press.config";

export const GET = createFeed(config);
export const revalidate = 300;
