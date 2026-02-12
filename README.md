# Instagram File Sharer

A Chrome extension that allows you to share files on Instagram DM using Filebin's free file hosting service.

## Features

- 📎 Adds a paperclip button to Instagram DM conversations
- 🚀 Uploads files to Filebin automatically
- 🔗 Inserts the file link directly into the message input
- ✨ Clean, Instagram-native UI design
- 🌓 Dark mode support

## Usage

1. **Open Instagram DM**
   - Go to https://www.instagram.com/
   - Open any direct message conversation

2. **Upload a file**
   - Look for the paperclip icon (📎) near the message input
   - Click it and select your file
   - Wait for the upload to complete

3. **Send the link**
   - The Filebin link will be automatically inserted into the message box
   - Click the Send button to share the file link

## How It Works

### Technical Flow

1. **File Upload**: When you select a file, it's uploaded to Filebin via POST request
   ```
   POST https://filebin.net/[bin_id]/[filename]
   ```

2. **Link Generation**: Filebin returns a 201 Created status with the file URL
   ```
   https://filebin.net/[bin_id]/[filename]
   ```

3. **Message Insertion**: The link is automatically inserted into Instagram's message input

4. **Manual Send**: You click the send button to share the link

### Permissions

- `instagram.com`: Required to inject the upload button and interact with the message input
- `filebin.net`: Required to upload files to Filebin's servers

## Important Notes

### Filebin Terms
- Files are stored temporarily (usually 6 days)
- No account required
- Free service with reasonable limits
- Read Filebin's terms: https://filebin.net/

### Privacy
- Files are uploaded to a third-party service (Filebin)
- Links are publicly accessible to anyone who has them
- Do not upload sensitive or private files
- This extension does not collect or store any user data

### Limitations
- Instagram may change their DOM structure, requiring updates
- Maximum file size depends on Filebin's limits
- Upload speed depends on your internet connection

## Troubleshooting

### Upload button not appearing
- Refresh the Instagram page
- Make sure you're in a DM conversation (not on the main feed)
- Check that the extension is enabled in `chrome://extensions/`

### Upload fails
- Check your internet connection
- Try a smaller file size
- Verify Filebin.net is accessible from your network

### Link not inserting
- Instagram may have updated their interface
- Try clicking in the message box first
- Manually paste the link from the success notification

## Contributing

Feel free to submit issues or pull requests for:
- Bug fixes
- Instagram UI compatibility updates
- Feature enhancements
- Better error handling

## License

MIT License - Feel free to use and modify as needed.

## Disclaimer

This extension is not affiliated with Instagram, Facebook, Meta, or Filebin. Use at your own risk.
