#!/usr/bin/env node
/**
 * asset-version: v1.0
 * updated: 2026-08-20
 * owner_surface: root ai-info.json and llms.txt for Polymarket Toolkit
 * behavior_change: generate machine-readable product facts from one reviewed registry and fail closed on MCP version drift
 * rollback: remove this script, content/ai-identity.json, generated outputs, package scripts, and the matching contract test together
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')
const registryPath = resolve(root, 'content/ai-identity.json')
const identity = JSON.parse(readFileSync(registryPath, 'utf8'))
const mcpPackage = JSON.parse(readFileSync(resolve(root, 'mcp/package.json'), 'utf8'))
const serverManifest = JSON.parse(readFileSync(resolve(root, 'mcp/server.json'), 'utf8'))

function requiredString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`[ai-discovery] ${label} is required`)
}

function validate() {
  if (identity.schema_version !== '1.0') throw new Error('[ai-discovery] schema_version must be 1.0')
  for (const field of ['id','identity_version','last_verified_at','source_revision','name','canonical_url','ai_info_url','llms_url','category','one_sentence_description']) {
    requiredString(identity[field], field)
  }
  for (const field of ['best_for','not_for','data_sources','limitations','related_entities','citation_guidance']) {
    if (!Array.isArray(identity[field]) || identity[field].length === 0) throw new Error(`[ai-discovery] ${field} must be non-empty`)
  }
  const mcp = identity.capabilities?.mcp
  if (!mcp || !Array.isArray(mcp.tools) || mcp.tools.length === 0) throw new Error('[ai-discovery] capabilities.mcp.tools is required')
  if (new Set(mcp.tools).size !== mcp.tools.length) throw new Error('[ai-discovery] duplicate MCP tool names')
  if (mcp.package_version !== mcpPackage.version) throw new Error(`[ai-discovery] identity MCP version ${mcp.package_version} != package ${mcpPackage.version}`)
  if (serverManifest.version !== mcpPackage.version || serverManifest.packages?.[0]?.version !== mcpPackage.version) {
    throw new Error(`[ai-discovery] server manifest must match npm package ${mcpPackage.version}`)
  }
  if (serverManifest.packages?.[0]?.identifier !== mcp.npm_package) throw new Error('[ai-discovery] npm package identifier drift')
  if (serverManifest.name !== mcp.registry_name) throw new Error('[ai-discovery] MCP registry name drift')
  for (const field of ['authentication','network_write','local_write','trading']) requiredString(identity.boundaries?.[field], `boundaries.${field}`)
  return identity
}

function bullets(items) {
  return items.map((item) => `- ${item}`).join('\n')
}

function links(entries) {
  return Object.entries(entries).map(([key, value]) => `- ${key}: ${value}`).join('\n')
}

function buildLlms() {
  const mcp = identity.capabilities.mcp
  return `# ${identity.name}\n\n> ${identity.one_sentence_description}\n\nLast verified: ${identity.last_verified_at}\nCanonical repository: ${identity.canonical_url}\nMachine facts: ${identity.ai_info_url}\n\n## Best For\n\n${bullets(identity.best_for)}\n\n## Not For\n\n${bullets(identity.not_for)}\n\n## MCP Server\n\n- Registry name: ${mcp.registry_name}\n- npm package: ${mcp.npm_package}@${mcp.package_version}\n- Transport: ${mcp.transport}\n- Install: \`${mcp.install_command}\`\n- Tools (${mcp.tools.length}, all read-only): ${mcp.tools.map((tool) => `\`${tool}\``).join(', ')}\n\n## Boundaries\n\n- Authentication: ${identity.boundaries.authentication}\n- Network writes: ${identity.boundaries.network_write}\n- Local writes: ${identity.boundaries.local_write}\n- Trading: ${identity.boundaries.trading}\n\n## Data Sources\n\n${bullets(identity.data_sources)}\n\n## Limitations\n\n${bullets(identity.limitations)}\n\n## Official Resources\n\n${links(identity.official_urls)}\n\n## Citation Guidance\n\n${bullets(identity.citation_guidance)}\n`
}

validate()
const outputs = [
  {
    path: 'ai-info.json',
    content: `${JSON.stringify({ generated_from: 'content/ai-identity.json', ...identity }, null, 2)}\n`,
  },
  { path: 'llms.txt', content: buildLlms() },
]

let mismatches = 0
for (const output of outputs) {
  const target = resolve(root, output.path)
  if (check) {
    const actual = existsSync(target) ? readFileSync(target, 'utf8') : null
    if (actual !== output.content) {
      console.error(`[ai-discovery] stale or missing: ${output.path}`)
      mismatches++
    }
  } else {
    writeFileSync(target, output.content)
    console.log(`[ai-discovery] wrote ${output.path}`)
  }
}
if (check && mismatches > 0) process.exit(1)
if (check) console.log(`[ai-discovery] PASS ${outputs.length} outputs match content/ai-identity.json`)
