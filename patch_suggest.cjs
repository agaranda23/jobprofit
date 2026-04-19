const fs = require('fs')
const path = require('path')

const filePath = path.join(process.cwd(), 'app/components/HomeClient.js')
let src = fs.readFileSync(filePath, 'utf8')

// Add state for image URL
src = src.replace(
  `  const [suggestNotes, setSuggestNotes] = useState('')`,
  `  const [suggestNotes, setSuggestNotes] = useState('')
  const [suggestImage, setSuggestImage] = useState('')`
)

// Add image field to form UI after website field
src = src.replace(
  `            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Anything else? <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional)</span></div>`,
  `            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Image URL <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional — Instagram post, website photo etc)</span></div>
              <input value={suggestImage} onChange={e => setSuggestImage(e.target.value)} placeholder="https://..."
                style={{ width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid #D1D5DB', boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Anything else? <span style={{ fontWeight: 400, color: '#9CA3AF' }}>(optional)</span></div>`
)

// Add image to submission
src = src.replace(
  `                  await sb.from('listing_suggestions').insert([{
                    name: suggestName.trim(),
                    location: suggestLocation.trim() || null,
                    website: suggestWebsite.trim() || null,
                    notes: suggestNotes.trim() || null,
                  }])`,
  `                  await sb.from('listing_suggestions').insert([{
                    name: suggestName.trim(),
                    location: suggestLocation.trim() || null,
                    website: suggestWebsite.trim() || null,
                    notes: suggestNotes.trim() || null,
                    image_url: suggestImage.trim() || null,
                  }])`
)

fs.writeFileSync(filePath, src)
console.log('done')
