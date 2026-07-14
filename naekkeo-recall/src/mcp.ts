import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  checkProductsBatch,
  checkProductsBatchInputSchema,
  createRecallActionPlan,
  makeRecallActionPlanInputSchema,
  searchProductSafety,
  searchProductSafetyInputSchema,
  type RecallToolDependencies,
  verifyRecallMatch,
  verifyRecallMatchInputSchema,
} from "./tools.js";

export function createMcpServer(dependencies: RecallToolDependencies): McpServer {
  const server = new McpServer({ name: "naekkeo-recall", version: "0.1.0" });

  server.registerTool("search_product_safety", {
    title: "제품 안전 검색",
    description: "Search official product safety and certification records with My Recall(내꺼리콜).",
    inputSchema: searchProductSafetyInputSchema,
    annotations: annotations("제품 안전 검색"),
  }, (product) => searchProductSafety(dependencies, product));

  server.registerTool("verify_recall_match", {
    title: "리콜 일치 대조",
    description: "Verify an official recall match with My Recall(내꺼리콜) without making safety guarantees.",
    inputSchema: verifyRecallMatchInputSchema,
    annotations: annotations("리콜 일치 대조"),
  }, (product) => verifyRecallMatch(dependencies, product));

  server.registerTool("make_recall_action_plan", {
    title: "리콜 조치 계획",
    description: "Create an official-notice-based recall action plan with My Recall(내꺼리콜).",
    inputSchema: makeRecallActionPlanInputSchema,
    annotations: annotations("리콜 조치 계획"),
  }, (product) => createRecallActionPlan(dependencies, product));

  server.registerTool("check_products_batch", {
    title: "제품 일괄 점검",
    description: "Check up to ten products against official recalls with My Recall(내꺼리콜).",
    inputSchema: checkProductsBatchInputSchema,
    annotations: annotations("제품 일괄 점검"),
  }, ({ products }) => checkProductsBatch(dependencies, products));

  return server;
}

function annotations(title: string) {
  return {
    title,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  };
}
