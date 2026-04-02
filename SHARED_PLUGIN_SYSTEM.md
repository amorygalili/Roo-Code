## Shared plugin system

I would like to create a plugin package that's agnostic to any particular agent/code assistant. It should be a node package that defines interfaces that each code assistant much implement. The purpose of this is to make it easy to adapt the same plugin code to multiple agents/code assistants. This package should be as simple and as light weight as possible and should include interfaces for the following features (not comprehensive):

- Profiles
    - Adding, configuring and setting profiles. Profiles are used to manage different sets of AI settings, allowing users to quickly switch between various API providers, models and parameters.
    - Getting list of profiles and indivudal profiles. Getting current AI settings
- Adding tools and MCP servers
- Sending and receiving messages from the agent. Interrupting agent.
    - Types of agent messages: "say" and "ask"
- Starting tasks/chats. Setting current chat
- Getting token usage information
    - tokens in
    - tokens out
    - cost
    - context tokens
- error messages from agent
    - tool call failure
    - error sending message to LLM
