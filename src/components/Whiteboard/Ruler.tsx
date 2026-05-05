import React from 'react';
import { Group, Rect, Line, Text } from 'react-konva';
import { ToolState } from '../../types/whiteboard';

interface RulerProps {
  state: ToolState;
  onChange: (newState: ToolState) => void;
  documentScale?: number;
  resolutionScale?: number;
  draggable?: boolean;
  listening?: boolean;
}

export const Ruler: React.FC<RulerProps> = React.memo(({ state, onChange, documentScale = 1, resolutionScale = 1, draggable = true, listening = true }) => {
  const isCm = state.unit === 'cm';
  
  // 1 inch = 96 pixels at standard resolution
  const inchStep = 96 * state.scale * resolutionScale;
  // 1 cm = 37.79527559 pixels (96 / 2.54)
  const cmStep = (96 / 2.54) * state.scale * resolutionScale;
  
  const unitStep = isCm ? cmStep : inchStep;
  const numUnits = isCm ? 30 : 12; // 30cm or 12in (Standard ruler sizes)
  
  // Add a small padding (lead-in) at the start so the 0 mark isn't on the absolute edge
  const padding = 10; 
  const width = (numUnits * unitStep) + (padding * 2);
  const height = 80 * state.scale * (resolutionScale > 1 ? 1 : resolutionScale); // Caps height growth

  const markings = React.useMemo(() => {
    const result = [];
    
    for (let i = 0; i <= numUnits; i++) {
      const x = padding + (i * unitStep);
      
      // Major Marker
      result.push(
        <React.Fragment key={`unit-${i}`}>
          <Line
            points={[x, 0, x, 30]}
            stroke="#0f172a"
            strokeWidth={2}
          />
          <Text
            x={x - 20}
            y={35}
            width={40}
            text={`${i}`}
            fontSize={(isCm ? 12 : 14) * resolutionScale}
            fontStyle="bold"
            fill="#0f172a"
            align="center"
          />
          
          {/* Subdivisions */}
          {i < numUnits && (isCm ? (
            // Centimeter subdivisions (10 mm)
            Array.from({ length: 9 }).map((_, j) => {
              const mmIndex = j + 1;
              const mmX = x + (mmIndex * unitStep / 10);
              const h = mmIndex === 5 ? 20 : 12;
              const weight = mmIndex === 5 ? 1.5 : 1;
              
              return (
                <Line
                  key={`mm-${i}-${j}`}
                  points={[mmX, 0, mmX, h]}
                  stroke="#475569"
                  strokeWidth={weight}
                />
              );
            })
          ) : (
            // Inch subdivisions (1/16 inch)
            Array.from({ length: 15 }).map((_, j) => {
              const subIndex = j + 1;
              const subX = x + (subIndex * unitStep / 16);
              
              let h = 10;
              let weight = 1;
              let color = "#94a3b8";
              
              if (subIndex === 8) { h = 25; weight = 2; color = "#334155"; }
              else if (subIndex === 4 || subIndex === 12) { h = 18; weight = 1.5; color = "#475569"; }
              else if (subIndex % 2 === 0) { h = 14; weight = 1; color = "#64748b"; }

              return (
                <Line
                  key={`sub-${i}-${j}`}
                  points={[subX, 0, subX, h]}
                  stroke={color}
                  strokeWidth={weight}
                />
              );
            })
          ))}
        </React.Fragment>
      );
    }
    return result;
  }, [width, unitStep, isCm, numUnits]);

  return (
    <Group
      x={state.x}
      y={state.y}
      rotation={state.rotation}
      draggable={draggable}
      onDragEnd={(e) => {
        if (e.target !== e.currentTarget) return;
        onChange({ ...state, x: e.target.x(), y: e.target.y() });
      }}
      visible={state.visible}
      listening={listening}
    >
      {/* Ruler Body */}
      <Rect
        width={width}
        height={height}
        fill="rgba(251, 191, 36, 0.85)"
        stroke="#0f172a"
        strokeWidth={2}
        cornerRadius={8}
        shadowBlur={0}
        shadowOffset={{ x: 4, y: 4 }}
        shadowColor="#0f172a"
        shadowOpacity={1}
      />
      
      {/* Unit Label & Toggle Area */}
      <Group
        x={width / 2 - 50}
        y={height - 25}
        onClick={() => onChange({ ...state, unit: isCm ? 'in' : 'cm' })}
        onTap={() => onChange({ ...state, unit: isCm ? 'in' : 'cm' })}
        cursor="pointer"
      >
        <Rect 
          width={100}
          height={20}
          fill="rgba(255,255,255,0.3)"
          cornerRadius={4}
        />
        <Text
          width={100}
          height={20}
          text={isCm ? 'UNIT: CM (Click to swap)' : 'UNIT: IN (Click to swap)'}
          fontSize={9}
          fontStyle="bold"
          fill="#b45309"
          align="center"
          verticalAlign="middle"
        />
      </Group>
      
      {markings}

      {/* Rotation Handle - Scaled and styled better */}
      <Group
        x={width - 25}
        y={height / 2 - 12}
        draggable={draggable}
        onDragMove={(e) => {
          const stage = e.target.getStage();
          if (!stage) return;
          const pos = stage.getPointerPosition();
          if (!pos) return;
          
          const dx = (pos.x / documentScale) - state.x;
          const dy = (pos.y / documentScale) - state.y;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          
          onChange({ ...state, rotation: angle });
          e.target.x(width - 25);
          e.target.y(height / 2 - 12);
        }}
      >
        <Rect
          width={24}
          height={24}
          fill="#3b82f6"
          cornerRadius={12}
          stroke="#1e40af"
          strokeWidth={2}
          shadowBlur={4}
          shadowOpacity={0.2}
        />
        <Line
           points={[6, 12, 18, 12, 12, 6, 18, 12, 12, 18]}
           stroke="white"
           strokeWidth={2}
           lineJoin="round"
           lineCap="round"
        />
      </Group>
    </Group>
  );
});
