import os
import zlib
import struct

def create_png(width, height, color_rgb):
    # PNG signature
    png = b'\x89PNG\r\n\x1a\n'
    
    # IHDR chunk
    # width (4), height (4), bit depth (1), color type (2=RGB), compression (0), filter (0), interlace (0)
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_crc = struct.pack('>I', zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff)
    png += struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + ihdr_crc
    
    # Raw pixel data (filter byte 0 per scanline + RGB)
    raw_data = bytearray()
    r, g, b = color_rgb
    for y in range(height):
        raw_data.append(0) # filter type 0 (None)
        for x in range(width):
            # Check border
            border = 2 if width >= 32 else 1
            if x < border or x >= width - border or y < border or y >= height - border:
                raw_data.extend((0, 90, 200)) # darker blue border
            else:
                raw_data.extend((r, g, b)) # #0071e3
                
    # IDAT chunk
    compressed = zlib.compress(bytes(raw_data), level=9)
    idat_crc = struct.pack('>I', zlib.crc32(b'IDAT' + compressed) & 0xffffffff)
    png += struct.pack('>I', len(compressed)) + b'IDAT' + compressed + idat_crc
    
    # IEND chunk
    iend_crc = struct.pack('>I', zlib.crc32(b'IEND') & 0xffffffff)
    png += struct.pack('>I', 0) + b'IEND' + iend_crc
    
    return png

icons_dir = r"c:\Users\gusta\Paulifest-Seller-Copilot\public\icons"
os.makedirs(icons_dir, exist_ok=True)

# Paulifest blue #0071e3
blue = (0, 113, 227)
for size in [16, 32, 48, 128]:
    path = os.path.join(icons_dir, f"icon{size}.png")
    with open(path, "wb") as f:
        f.write(create_png(size, size, blue))
    print(f"Generated {path}")
