# Debug logs

在控制面板的“隐私与高级”中启用调试日志。日志写入：

```text
~/Library/Application Support/Mouthpiece/logs/
```

日志会脱敏 API Key、Authorization header 和常见凭据字段，只保留最近 20 个文件，并自动删除 7 天以前的文件。

排查录音或实时识别时，建议记录问题发生的准确时间、Provider、模型、麦克风和显示器布局，再附上对应时间段日志。不要公开完整的 Keychain 内容或未经检查的用户文本。
