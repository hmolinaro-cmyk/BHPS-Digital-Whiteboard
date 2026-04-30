import React from 'react';
import { Image } from 'react-konva';
import useImage from 'use-image';

interface PDFPageProps {
  url: string;
  width: number;
  onHeightChange?: (height: number) => void;
}

export const PDFPage: React.FC<PDFPageProps> = ({ url, width, onHeightChange }) => {
  const [image] = useImage(url);
  
  React.useEffect(() => {
    if (image && onHeightChange) {
      const scale = width / image.width;
      onHeightChange(image.height * scale);
    }
  }, [image, width, onHeightChange]);

  if (!image) return null;
  
  const scale = width / image.width;
  
  return (
    <Image
      image={image}
      x={0}
      y={0}
      width={width}
      height={image.height * scale}
      listening={false}
    />
  );
};
