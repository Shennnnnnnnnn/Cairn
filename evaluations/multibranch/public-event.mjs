// Preserve observable events without duplicating private thinking into evaluator audit files.
export function publicEvent(event){
 if(!event||!['session','message_end','tool_execution_start','tool_execution_end','agent_start','agent_end'].includes(event.type))return undefined;
 const saved=structuredClone(event);
 if(Array.isArray(saved.message?.content))saved.message.content=saved.message.content.filter(part=>part?.type!=='thinking');
 return saved;
}
