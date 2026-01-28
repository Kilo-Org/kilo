#!/usr/bin/env bun
// kilocode_change - new file
// Beta pack script - builds and packs beta release
// This sets the beta channel before running the standard pack script

// Set beta channel environment variable
process.env.OPENCODE_CHANNEL = 'beta'

console.log('🔵 Building beta release...')
console.log('Channel:', process.env.OPENCODE_CHANNEL)

// Import and run the standard pack script
// This will build all platform binaries and create packages
await import('./pack.ts')

console.log('✅ Beta pack complete!')
console.log('📦 Packages created in ./dist/')
console.log('🚀 Ready to publish with: npm publish *.tgz --tag beta --access public')
