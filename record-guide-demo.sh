#!/bin/bash
# Script to capture a Guide Mode session example

echo "🎬 Recording Guide Mode Session Example"
echo ""
echo "This will help you create an example for the PR."
echo ""
echo "Steps:"
echo "1. Run: bun dev --agent guide"
echo "2. Go through the 5 discovery questions naturally"
echo "3. Show the final refined prompt"
echo "4. Switch to plan mode"
echo ""
echo "Example conversation to have:"
echo "- User: 'I want to build a todo app'"
echo "- Answer the 5 questions naturally"
echo "- Show how AI refines it into a detailed prompt"
echo ""
echo "To capture the session:"
echo "- Option 1: Copy-paste the conversation from the terminal"
echo "- Option 2: Use asciinema to record: asciinema rec guide-mode-demo.cast"
echo "- Option 3: Take screenshots of key moments"
echo ""
echo "Ready to start? (Press Enter to continue)"
read

echo ""
echo "Starting Kilo in Guide Mode..."
echo "Remember to:"
echo "✅ Start with a simple idea (e.g., 'todo app' or 'portfolio website')"
echo "✅ Answer the 5 discovery questions naturally"
echo "✅ Show the refined prompt at the end"
echo "✅ Demonstrate switching to plan mode"
echo ""

bun dev --agent guide
