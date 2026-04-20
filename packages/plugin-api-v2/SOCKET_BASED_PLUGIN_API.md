- I would like to make the plugin-api package websocket based so that its easier to create plugin systems for other editors and programming languages.
- The plugin-api should now provide PluginServer and PluginClient classes. PluginServer instances create websocket servers and PluginClient instances create websocket clients that connect to the PluginServer.
- Agents/code assistants such as Roo Code should create a PluginServer instance and plugins should create PluginClient instances.
- PluginClient should have the same (or very similar) interface to what plugins currently have. For example, they should still have .upsertProfile and .registerTool methods.
- Agents like Roo Code receive messages through events. For example, a plugin calls `client.upsertProfile(PROFILE_NAME, PROFILE_SETTINGS, false)`, which sends a message to the PluginServer instance created inside Roo Code. Roo Code can then listen for when the client calls .upsertProfile like this:

```typescript
server.on('upsertProfile', (profileName, profileSettings, activate) => {
    ...
});
```

Please don't modify existing code for now. Just create a plugin-api-v2 package and I will review the code before we update Roo Code so that it uses it instead of the old plugin-api package.
