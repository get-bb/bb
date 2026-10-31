`quadrants.heic` is a generated 64×32 test image with different colors in each quadrant. It was encoded with macOS `sips` from a generated PNG and contains no personal photo data. It is provided under the repository's MIT license.

`quadrants-rotated.heic` contains the same compressed image, with its HEIF `irot` property set to a 90° counterclockwise rotation. Its displayed dimensions are 32×64.

`quadrants-primary-second.heic` duplicates the generated image as a second top-level item, marks that second item as primary, and applies the 90° counterclockwise rotation only to it. Both items reference the same compressed pixels; the first displays as 64×32 and the primary displays as 32×64.
