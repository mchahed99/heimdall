/**
 * Intelligent Commerce — AI Agent MCP Server
 *
 * Simulates a Agentic commerce platform where AI agents
 * can process payments, access cardholder data, issue refunds, and
 * send settlement reports on behalf of merchants and consumers.
 *
 * This server is intentionally unsecured — no policy file exists.
 * Run `heimdall audit --path examples/demo-bank` to generate one.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "intelligent-commerce", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ── Tool Definitions ───────────────────────────────────────────────

const TOOLS = [
  {
    name: "process_payment",
    description:
      "Process a tokenized payment on behalf of a consumer. Charges the cardholder and settles funds to the merchant. Supports cross-border transactions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cardholder_token: { type: "string", description: "Tokenized credential (network token)" },
        merchant_id: { type: "string", description: "Merchant ID" },
        amount: { type: "number", description: "Transaction amount in cents" },
        currency: { type: "string", description: "ISO 4217 currency code" },
        description: { type: "string", description: "Payment description" },
        metadata: { type: "object", description: "Arbitrary metadata attached to the transaction" },
      },
      required: ["cardholder_token", "merchant_id", "amount", "currency"],
    },
  },
  {
    name: "get_cardholder_profile",
    description:
      "Retrieve cardholder profile including PII (name, billing address, last four digits, spend tier). Used by AI agents to personalize offers and verify identity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cardholder_token: { type: "string", description: "Tokenized credential" },
        include_pii: { type: "boolean", description: "Include full PII (name, address, phone)" },
      },
      required: ["cardholder_token"],
    },
  },
  {
    name: "export_transactions",
    description:
      "Export transaction history to an external endpoint for reconciliation, analytics, or regulatory reporting. Supports CSV and JSON formats.",
    inputSchema: {
      type: "object" as const,
      properties: {
        merchant_id: { type: "string", description: "Merchant to export transactions for" },
        endpoint: { type: "string", description: "HTTPS endpoint to POST the export to" },
        format: { type: "string", enum: ["csv", "json"], description: "Export format" },
        date_range: {
          type: "object",
          properties: {
            from: { type: "string", description: "Start date (ISO 8601)" },
            to: { type: "string", description: "End date (ISO 8601)" },
          },
        },
        include_cardholder_data: { type: "boolean", description: "Include cardholder PII in export" },
      },
      required: ["merchant_id", "endpoint", "format"],
    },
  },
  {
    name: "issue_refund",
    description:
      "Issue a full or partial refund to a cardholder. Reverses the original transaction and initiates settlement back to the issuing bank.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transaction_id: { type: "string", description: "Original transaction ID to refund" },
        amount: { type: "number", description: "Refund amount in cents (omit for full refund)" },
        reason: { type: "string", description: "Refund reason code" },
      },
      required: ["transaction_id"],
    },
  },
  {
    name: "update_merchant_config",
    description:
      "Update merchant configuration: webhook URLs, settlement accounts, fraud thresholds, and API credentials. Changes take effect immediately.",
    inputSchema: {
      type: "object" as const,
      properties: {
        merchant_id: { type: "string", description: "Merchant ID" },
        webhook_url: { type: "string", description: "New webhook endpoint for transaction notifications" },
        settlement_account: { type: "string", description: "Bank account number for settlements" },
        fraud_threshold: { type: "number", description: "Fraud score threshold (0-100)" },
        api_credentials: {
          type: "object",
          properties: {
            client_id: { type: "string" },
            client_secret: { type: "string" },
          },
        },
      },
      required: ["merchant_id"],
    },
  },
  {
    name: "send_settlement_report",
    description:
      "Send daily settlement report to a specified endpoint. Contains aggregate transaction volumes, fees, chargebacks, and net settlement amounts per merchant.",
    inputSchema: {
      type: "object" as const,
      properties: {
        endpoint: { type: "string", description: "HTTPS endpoint to POST the report to" },
        date: { type: "string", description: "Settlement date (ISO 8601)" },
        include_merchant_details: { type: "boolean", description: "Include per-merchant breakdown" },
        format: { type: "string", enum: ["json", "csv", "pdf"] },
      },
      required: ["endpoint", "date"],
    },
  },
  {
    name: "flag_transaction",
    description:
      "Flag a transaction for fraud review or compliance hold. Can also auto-block the cardholder token if risk score exceeds threshold.",
    inputSchema: {
      type: "object" as const,
      properties: {
        transaction_id: { type: "string", description: "Transaction ID to flag" },
        reason: { type: "string", enum: ["fraud", "compliance", "sanctions", "velocity"], description: "Flag reason" },
        action: { type: "string", enum: ["review", "hold", "block_token"], description: "Action to take" },
        notes: { type: "string", description: "Agent notes for the review team" },
      },
      required: ["transaction_id", "reason", "action"],
    },
  },
];

// ── Handlers ───────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Simulated responses for each tool
  switch (name) {
    case "process_payment":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "approved",
            transaction_id: `txn_${crypto.randomUUID().slice(0, 12)}`,
            authorization_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
            amount: (args as Record<string, unknown>).amount,
            currency: (args as Record<string, unknown>).currency,
            network: "CardNet",
            timestamp: new Date().toISOString(),
          }),
        }],
      };

    case "get_cardholder_profile":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            token: (args as Record<string, unknown>).cardholder_token,
            name: "Sarah Chen",
            last_four: "4242",
            spend_tier: "platinum",
            billing_address: "1455 Market St, San Francisco, CA 94103",
            phone: "+1-415-555-0142",
            email: "s.chen@example.com",
          }),
        }],
      };

    case "export_transactions":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "delivered",
            endpoint: (args as Record<string, unknown>).endpoint,
            records_exported: 1847,
            total_volume: "$2,341,892.00",
            format: (args as Record<string, unknown>).format,
          }),
        }],
      };

    case "issue_refund":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "processed",
            refund_id: `ref_${crypto.randomUUID().slice(0, 12)}`,
            original_transaction: (args as Record<string, unknown>).transaction_id,
            amount_refunded: (args as Record<string, unknown>).amount ?? "full",
            settlement_eta: "2-3 business days",
          }),
        }],
      };

    case "update_merchant_config":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "updated",
            merchant_id: (args as Record<string, unknown>).merchant_id,
            changes_applied: Object.keys(args as Record<string, unknown>).filter(k => k !== "merchant_id"),
            effective_immediately: true,
          }),
        }],
      };

    case "send_settlement_report":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "delivered",
            endpoint: (args as Record<string, unknown>).endpoint,
            date: (args as Record<string, unknown>).date,
            merchants_included: 342,
            total_settled: "$18,492,103.42",
            total_fees: "$184,921.03",
          }),
        }],
      };

    case "flag_transaction":
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            status: "flagged",
            transaction_id: (args as Record<string, unknown>).transaction_id,
            action_taken: (args as Record<string, unknown>).action,
            case_id: `case_${crypto.randomUUID().slice(0, 8)}`,
            escalated_to: "fraud_ops_team",
          }),
        }],
      };

    default:
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// ── Start ──────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[IC-MCP] Intelligent Commerce server ready — 7 tools available");
