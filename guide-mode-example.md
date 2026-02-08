## 📸 Guide Mode in Action - Real Session Example

### Before Guide Mode (Typical User Struggle)

**User:** "Make a website"

**Result:** ❌ Vague prompt → Poor results → Frustration → Abandonment

The AI doesn't know:
- What kind of website?
- Who is it for?
- What problem does it solve?
- User's experience level
- Any specific requirements

---

### After Guide Mode (New User Success)

**Step 1: Enter Guide Mode**
```bash
kilo --agent guide
```

**Step 2: Discovery Conversation**

**AI:** Hello! 👋 I'm excited to help you build something amazing!

What are you trying to build? Describe your idea in your own words.

**User:** I want to build a todo app to track my daily tasks

**AI:** Great idea! A todo app is perfect for staying organized. 

Who is this for?

**User:** Just me, for personal use

**AI:** Awesome! Personal productivity apps are great projects.

What problem does this solve? Why do you need it?

**User:** I keep forgetting tasks and want to see my progress over time

**AI:** I love that you want to track progress! That's a great motivator.

What's your experience level with coding?

**User:** I'm a beginner, just learning

**AI:** Perfect! I'll make sure the code is beginner-friendly with lots of comments.

Any specific requirements? (Tech preferences, constraints, must-haves)

**User:** I'd like it to work on my phone and look clean and simple

**AI:** Great! Mobile-responsive and clean UI - got it!

---

### Step 3: AI Creates Refined Prompt

**AI:** Perfect! Based on our conversation, here's what I understand:

**Project:** Personal Todo App with Progress Tracking

**Details:**
- **What:** A mobile-responsive todo application for tracking daily tasks
- **Who:** Personal use (single user)
- **Why:** Forget tasks less often and visualize progress over time
- **Experience:** Beginner-friendly code with educational comments
- **Requirements:** 
  - Mobile-responsive design
  - Clean, simple UI
  - Task completion tracking
  - Progress visualization

**Refined Prompt:**
```
Create a beginner-friendly, mobile-responsive todo application for personal 
use with the following features:

Core Features:
- Add, edit, and delete daily tasks
- Mark tasks as complete with satisfying visual feedback
- View task history and completion statistics
- Progress visualization (e.g., weekly completion charts)

Technical Requirements:
- Mobile-first responsive design (works on phone and desktop)
- Clean, minimal UI with intuitive navigation
- Local storage to persist tasks between sessions
- Beginner-friendly code with detailed comments explaining each section

Tech Stack Suggestion:
- HTML5 for structure
- CSS3 with Flexbox/Grid for responsive layout
- Vanilla JavaScript (no frameworks needed for this scope)
- localStorage API for data persistence

The code should be educational for a beginner, with comments explaining 
WHY certain decisions are made, not just WHAT the code does.
```

---

### Step 4: Choose Next Step

**AI:** Would you like to:

1. **Switch to Plan mode** - Create a detailed implementation plan with specific files and steps
2. **Switch to Code mode** - Start building immediately with AI assistance
3. **Stay in Guide mode** - Continue refining the requirements

**User:** Let's switch to Plan mode

**AI:** [Uses guide_exit tool to switch to plan mode]

---

## 🎯 Results

### ✅ What Guide Mode Accomplished:

1. **Clarified vague idea** → Specific project scope
2. **Discovered user needs** → Mobile-responsive, progress tracking
3. **Identified skill level** → Beginner-friendly with comments
4. **Defined constraints** → Personal use, clean UI
5. **Created actionable prompt** → Ready for plan/code mode

### 📊 Impact:

**Without Guide Mode:**
- ❌ Vague: "Make a website" → Generic results
- ❌ Assumptions: AI guesses tech stack and features
- ❌ Frustration: Results don't match expectations

**With Guide Mode:**
- ✅ Clear: Specific project with defined scope
- ✅ Aligned: AI understands exact user needs
- ✅ Educational: User learns what to ask for
- ✅ Success: Higher satisfaction, better results

---

## 💡 Key Insight

**Guide Mode teaches users HOW to work with AI** - it demonstrates:
- What information AI needs to help effectively
- How to communicate requirements clearly
- Why context matters for good results

This is something **no other AI coding tool offers** - true onboarding that improves user skills!
