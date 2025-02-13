import { createMem0, addMemories } from '@mem0/vercel-ai-provider';
import { streamText } from 'ai';
import { Pool } from 'pg';
import { OpenAI } from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: "postgresql://neondb_owner:2TYvAzNlt0Oy@ep-noisy-shape-a5hfgfjr.us-east-2.aws.neon.tech/documents?sslmode=require",
});

const mem0 = createMem0({
  provider: 'openai',
  mem0ApiKey: process.env.MEM0_API_KEY,
  apiKey: process.env.OPENAI_API_KEY,
  config: {
    compatibility: 'strict',
  },
});

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

type Persona = 'general' | 'roleplay';

// System prompts for different personas
const SYSTEM_PROMPTS: Record<Persona, string> = {
  general: `You are a specialized assistant with the following guidelines:

1. Conversational Approach:
   - Maintain a friendly and natural dialog flow
   - Use a warm, approachable tone
   - Show genuine interest in user questions
   - Engage in a way that encourages continued conversation

2. Content Restrictions:
   - Base all responses strictly on the provided context and conversation history
   - Do not use any external knowledge
   - Avoid making assumptions beyond what is explicitly stated
   - Format numerical data and statistics exactly as they appear in the context

3. Response Guidelines:
   - When information is available: Provide accurate answers while maintaining a conversational tone
   - When information is missing: Say "I wish I could help with that, but I don't have enough information in the provided documentation to answer your question. Is there something else you'd like to know about?"
   - For follow-up questions: Verify that previous responses were based on documented content

4. Quality Standards:
   - Ensure accuracy while remaining approachable
   - Balance professionalism with conversational friendliness
   - Maintain consistency in information provided
   - Keep responses clear and engaging`,

  roleplay: `
This Teach-Back is an activity where a user practices a skill they just learned in an online course. Refer to the course storyboard as well as the course assessment to provide you with context. This activity will be scored and it should reference only the material in the uploaded documents. You may reference other material in your feedback, but the scoring should be based solely on the course content. This activity is in section 2.3. I have outlined how the activity is structured below.
When the user clicks "begin", briefly describe the activity as a teach-back in which they'll receive personalized feedback based on their answer, Also state the rubric areas and what a passing score is. Then show the question "Explain how specialty medications impact the cost of pharmaceuticals and why this matters in pharmacy benefits consulting." After they submit their answer, grade them based on the rubric below and show them what their score is on each rubric area, as well as what could be done to improve. Continue providing guidance to improve their answer until they get a score of 8/8, then summarize their response into a final statement.
When a user clicks "instructions", explain in detail how the activity works and highlight that they are aiming for mastery and you will support them to achieve it. Show the full rubric and what their response should include (the 3 bullets below).
The user's response should include:
:heavy_tick: A clear definition of specialty medications and their key attributes.
:heavy_tick: An explanation of how specialty medications drive pharmaceutical costs.
:heavy_tick: A connection to pharmacy benefits consulting, including how PBMs and benefit strategies manage these costs.
Evaluation Criteria:
The user's response will be scored based on the rubric below, with a total of **8 possible points**. To pass, they need **at least 6 points**.
### Scoring Rubric (8 Points Total)
Scoring & Feedback Rubric
4) Excellent, 3) Good, 2) Fair, 1) Poor
Comprehensiveness
4) Clearly defines specialty medications, identifies key attributes and challenges, and explains their impact on pharmaceutical costs and PBMs.
3) Mentions specialty medications and their cost impact but lacks full explanation of attributes, challenges, or PBM connection.
2) Provides a vague or incomplete definition of specialty medications with little explanation of cost impact or relevance to PBMs.
1) Response is unclear, incorrect, or missing key details.
Clarity & Structure
4) Explanation is clear, well-organized, and easy to follow.
3) Mostly clear but could be better structured or more concise.
2) Somewhat unclear or disorganized.
1) Hard to follow or confusing.
:white_tick: **Passing Score:** 6+ out of 8
`
};

// Function to get embedding for a query
async function getQueryEmbedding(query: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: query,
  });
  return response.data[0].embedding;
}

// Function to find similar content from database
async function findSimilarContent(embedding: number[]): Promise<string> {
  // Format the embedding array as a PostgreSQL vector string
  const vectorString = `[${embedding.join(',')}]`;
  
  const query = `
    SELECT contents, 1 - (vector <=> $1::vector) as similarity
    FROM documents
    WHERE 1 - (vector <=> $1::vector) > 0.7
    ORDER BY similarity DESC
    LIMIT 5;
  `;
  
  const result = await pool.query(query, [vectorString]);
  return result.rows.map(row => row.contents).join('\n\n');
}

// Function to check if message is a greeting
function isGreeting(query: string): boolean {
  const greetingPatterns = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|greetings)(\s|$)/i,
    /^(how are you|what's up|wassup|sup)(\?|\s|$)/i,
    /^(hola|bonjour|hallo|ciao)(\s|$)/i
  ];
  
  return greetingPatterns.some(pattern => pattern.test(query.trim().toLowerCase()));
}

// Function to get greeting response
function getGreetingResponse(): string {
  const greetings = [
    "👋 Hello! How can I assist you today?",
    "Hi there! 😊 What can I help you with?",
    "👋 Hey! Ready to help you with any questions!",
    "Hello! 🌟 How may I be of assistance?",
    "Hi! 😃 Looking forward to helping you today!"
  ];
  
  return greetings[Math.floor(Math.random() * greetings.length)];
}

export const maxDuration = 30;

function isValidPersona(persona: any): persona is Persona {
  return ['general', 'roleplay'].includes(persona);
}

export async function POST(req: Request) {
  const totalStartTime = performance.now();
  try {
    console.log('🚀 Starting request processing...');
    const { messages, userId, persona: rawPersona = 'general' } = await req.json();
    const persona = isValidPersona(rawPersona) ? rawPersona : 'general';
    const userQuery = messages[messages.length - 1].content;
    const previousMessages = messages.slice(0, -1);

    // Check if the query is a greeting
    if (isGreeting(userQuery)) {
      console.log('👋 Greeting detected, sending default response');
      const greetingResponse = getGreetingResponse();
      
      // Create a stream response for greeting
      const result = await streamText({
        model: mem0('gpt-4o-mini', {
          user_id: userId,
        }),
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPTS[persona], // Use persona-specific prompt even for greetings
          },
          ...previousMessages,
          {
            role: 'user',
            content: userQuery
          },
          {
            role: 'assistant',
            content: greetingResponse
          }
        ],
      });

      // Add greeting to memories
      const greetingMessages = [
        { role: 'user', content: userQuery },
        { role: 'assistant', content: greetingResponse }
      ];
      await addMemories([...previousMessages, ...greetingMessages], {
        user_id: userId,
        mem0ApiKey: process.env.MEM0_API_KEY,
      });

      console.log('👋 Greeting response sent');
      return result.toDataStreamResponse();
    }

    // If not a greeting, proceed with normal processing
    console.log('💬 Processing regular query...');
    console.log(`🎭 Using ${persona} persona`);

    // Generate embedding directly from the original query
    const embedding = await getQueryEmbedding(userQuery);

    // Find similar content from the database
    const similarContent = await findSimilarContent(embedding);

    // Start response generation
    const responseStartTime = performance.now();
    console.log('💭 Starting response generation...');

    // Get the appropriate system prompt based on persona
    const systemPrompt = `${SYSTEM_PROMPTS[persona]}

Documentation Context: ${similarContent}`;

    const updatedMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...previousMessages.map((msg: Message) => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user' as const, content: userQuery }
    ];

    // Log the start of streaming
    console.log('📡 Initiating response stream...');
    
    // Stream the response using ai-sdk
    const result = await streamText({
      model: mem0('gpt-4o-mini', {
        user_id: userId,
      }),
      messages: updatedMessages,
    });

    const responseEndTime = performance.now();
    const streamInitTime = (responseEndTime - responseStartTime).toFixed(2);
    const totalTime = (responseEndTime - totalStartTime).toFixed(2);
    
    console.log(`⏱️ Stream initialization time: ${streamInitTime}ms`);
    console.log(`⌛ Total processing time: ${totalTime}ms`);

    // Add memories after streaming starts
    const finalMessages = [...updatedMessages];
    await addMemories(finalMessages, {
      user_id: userId,
      mem0ApiKey: process.env.MEM0_API_KEY,
    });

    console.log('✅ Request processing complete!');
    return result.toDataStreamResponse();
  } catch (error) {
    const errorTime = performance.now();
    const totalErrorTime = (errorTime - totalStartTime).toFixed(2);
    console.error(`❌ Error in chat route (after ${totalErrorTime}ms):`, error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
