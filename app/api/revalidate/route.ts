import { createRevalidateRoute } from "barakopress";
import { config } from "@/press.config";

export const { POST, GET } = createRevalidateRoute(config);
