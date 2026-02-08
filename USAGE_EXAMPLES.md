## Usage Examples

### Example 1: Building a Todo App

**Scenario:** A beginner wants to build their first app

```bash
$ kilo --agent guide

AI: Hello! 👋 I'm excited to help you build something amazing!
    
    What are you trying to build? Describe your idea in your own words.

User: I want a todo app to track my daily tasks

AI: Great idea! A todo app is perfect for staying organized. 
    
    Who is this for?

User: Just me, for personal use

AI: Awesome! Personal productivity apps are great projects.
    
    What problem does this solve? Why do you need it?

User: I keep forgetting tasks and want to see my progress

AI: I love that you want to track progress! That's a great motivator.
    
    What's your experience level with coding?

User: I'm a beginner, just learning

AI: Perfect! I'll make sure the code is beginner-friendly with lots of comments.
    
    Any specific requirements? (Tech preferences, constraints, must-haves)

User: I'd like it to work on my phone and look clean

AI: Great! Mobile-responsive and clean UI - got it!

    Thank you! Here's what I understand:

    **Project:** Personal Todo App with Progress Tracking
    
    **Details:**
    - What: A mobile-responsive todo application for tracking daily tasks
    - Who: Personal use (single user)
    - Why: Forget tasks less often and visualize progress over time
    - Experience: Beginner-friendly code with educational comments
    - Requirements: Mobile-responsive design, clean simple UI

    **Refined Prompt:**
    Create a beginner-friendly, mobile-responsive todo application...
    [Detailed specification with features, tech stack, requirements]

    Would you like to:
    1) Switch to Plan mode
    2) Switch to Code mode
    3) Stay in Guide mode

User: 1

AI: [Switches to plan mode and creates detailed implementation plan]
```

### Example 2: Real Session - Discovery Process

**Session ID:** `ses_3c3b076c3ffeSB8zm4uTBhoPFC`

**Scenario:** User testing Guide Mode with a simple interaction

```
User: hi

AI: Hello! 👋 I'm excited to help you build something amazing!
    
    I'll ask you a few quick questions to understand what you want to build.
    This helps me give you better results. Let's start!

    What are you trying to build? Describe your idea in your own words.

User: I want to build a landing page

AI: Great idea! Who is this for?

User: Just me, personal use

AI: Awesome! Personal projects are great for learning.
    
    What problem does this solve? Why do you need it?

User: I want to showcase my work online

AI: Excellent! What's your experience level with coding?

User: I'm a beginner

AI: Perfect! I'll make sure the code is beginner-friendly.
    
    Any specific requirements? (Tech preferences, constraints, must-haves)

User: Should look professional and work on mobile

AI: Got it! Professional, mobile-responsive landing page.

    Thank you! Based on your answers, here's what I understand:

    **Project:** Personal Landing Page
    
    **Details:**
    - What: A professional landing page to showcase work online
    - Who: Personal use (single user)
    - Why: Establish online presence and showcase portfolio
    - Experience: Beginner-friendly code with educational comments
    - Requirements: Mobile-responsive design, professional appearance

    **Refined Prompt:**
    Create a professional, mobile-responsive personal landing page...
    [Detailed specification with sections, tech stack, styling]

    Would you like to:
    1) Switch to Plan mode
    2) Switch to Code mode
    3) Stay in Guide mode
```

### Example 3: Portfolio Website

**Scenario:** Junior developer wants to showcase projects

```
AI: Hello! 👋 I'm excited to help you build something amazing!
    
    What are you trying to build?

User: I need a portfolio website to show my coding projects

AI: Great idea! Who is this for?

User: Potential employers and recruiters

AI: Perfect! What problem does this solve?

User: I need to showcase my work to get a job

AI: Excellent motivation! What's your experience level?

User: Junior developer, 1 year of experience

AI: Great! Any specific requirements?

User: Should look professional, load fast, work on mobile

AI: Got it! Professional, fast, mobile-responsive portfolio.

    [Creates refined prompt with professional portfolio specifications]
```

### Example 3: API Integration

**Scenario:** Intermediate developer building a tool

```
AI: What are you trying to build?

User: I want to build a CLI tool that fetches weather data

AI: Great! Who is this for?

User: Developers who want quick weather info in terminal

AI: What problem does this solve?

User: Checking weather without opening browser

AI: What's your experience level?

User: Intermediate, comfortable with APIs

AI: Any specific requirements?

User: Should support multiple locations, use OpenWeatherMap API

AI: Perfect! [Creates detailed CLI tool specification]
```

## Key Benefits Demonstrated

1. **No Prompt Engineering Required** - Guide Mode asks the right questions
2. **Context Discovery** - AI learns about user needs, constraints, and goals
3. **Educational** - Users learn what information helps AI produce better results
4. **Progressive Refinement** - Vague ideas become actionable specifications
5. **Flexible Output** - Can switch to Plan or Code mode based on preference

## Results

### Without Guide Mode:
```
User: "Make a todo app"
AI: [Generates generic todo app that may not match needs]
```

### With Guide Mode:
```
User: "Make a todo app"
AI: [Asks 5 questions]
User: [Provides context about mobile needs, progress tracking, beginner level]
AI: [Generates perfectly tailored todo app with mobile UI, progress charts, and beginner-friendly code]
```

## Mode Switching

After the discovery phase, Guide Mode offers three options:

1. **Plan Mode** - Create detailed implementation plan with file structure
2. **Code Mode** - Start coding immediately with AI assistance
3. **Stay in Guide** - Continue refining requirements

This flexibility ensures users can choose the approach that matches their comfort level and project complexity.
