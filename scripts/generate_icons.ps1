param(
    [string]$SourcePath = "C:\Users\isabe\.gemini\antigravity\brain\6d168085-2fea-45d8-8010-eda99d6ebb2e\.user_uploaded\media_1790699451809.png"
)

$csharpCode = @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public class CopilotWhiteBgIconGenerator
{
    public static void GenerateIcons(string srcPath, string[] targetDirs)
    {
        if (!File.Exists(srcPath))
        {
            throw new FileNotFoundException("Source icon not found at " + srcPath);
        }

        using (var src = (Bitmap)Image.FromFile(srcPath))
        {
            int w = src.Width;
            int h = src.Height;

            // Measure bounding box of artwork so it is well-proportioned on the white background
            int minX = w, minY = h, maxX = 0, maxY = 0;
            for (int y = 0; y < h; y += 2)
            {
                for (int x = 0; x < w; x += 2)
                {
                    Color c = src.GetPixel(x, y);
                    if (c.R < 242 || c.G < 242 || c.B < 242)
                    {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }

            int artW = maxX - minX;
            int artH = maxY - minY;
            int maxDim = Math.Max(artW, artH);
            int centerX = (minX + maxX) / 2;
            int centerY = (minY + maxY) / 2;

            // Keep a clean white margin around the logo (16% padding) with 100% SOLID WHITE BACKGROUND
            int cropSize = (int)(maxDim * 1.16);
            int cropX = centerX - (cropSize / 2);
            int cropY = centerY - (cropSize / 2);

            using (var highRes = new Bitmap(cropSize, cropSize, PixelFormat.Format24bppRgb))
            {
                using (var g = Graphics.FromImage(highRes))
                {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.CompositingQuality = CompositingQuality.HighQuality;
                    // Fill with pure white background
                    g.Clear(Color.White);
                    g.DrawImage(
                        src,
                        new Rectangle(0, 0, cropSize, cropSize),
                        new Rectangle(cropX, cropY, cropSize, cropSize),
                        GraphicsUnit.Pixel
                    );
                }

                foreach (var dir in targetDirs)
                {
                    Directory.CreateDirectory(dir);
                    SaveScaled(highRes, 256, Path.Combine(dir, "logo.png"));
                    SaveScaled(highRes, 128, Path.Combine(dir, "icon128.png"));
                    SaveScaled(highRes, 48, Path.Combine(dir, "icon48.png"));
                    SaveScaled(highRes, 32, Path.Combine(dir, "icon32.png"));
                    SaveScaled(highRes, 16, Path.Combine(dir, "icon16.png"));
                    Console.WriteLine("Generated white-background icons in: " + dir);
                }
            }
        }
    }

    private static void SaveScaled(Bitmap src, int size, string destFile)
    {
        using (var dest = new Bitmap(size, size, PixelFormat.Format24bppRgb))
        {
            using (var g = Graphics.FromImage(dest))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.Clear(Color.White);
                g.DrawImage(src, new Rectangle(0, 0, size, size));
            }
            dest.Save(destFile, ImageFormat.Png);
        }
    }
}
"@

Add-Type -TypeDefinition $csharpCode -ReferencedAssemblies 'System.Drawing'

$targetDirs = @(
    "C:\Users\isabe\.gemini\antigravity-ide\scratch\Paulifest-Seller-Copilot\public\icons",
    "C:\Users\isabe\.gemini\antigravity-ide\scratch\Paulifest-Seller-Copilot\dist\icons",
    "C:\Users\isabe\.codex\worktrees\75a3\Paulifest-Seller-Copilot\public\icons",
    "C:\Users\isabe\.codex\worktrees\75a3\Paulifest-Seller-Copilot\dist\icons"
)

[CopilotWhiteBgIconGenerator]::GenerateIcons($SourcePath, $targetDirs)
