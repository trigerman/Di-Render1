import { FixedLayout, Group, LayoutManager, Path, Textbox } from 'fabric';
import type { ProjectObject } from '../domain/project/schema';
import { shapeGeometry } from '../domain/shapes/registry';

type NativeShape = Extract<ProjectObject, {kind:'shape'}>;

/** A stable object frame keeps paths and text centred independently of their bounds. */
export function createNativeShape(value: NativeShape): Group {
  const group = new Group([], {
    width:value.width, height:value.height, originX:'center', originY:'center',
    layoutManager:new LayoutManager(new FixedLayout()),
  });
  updateNativeShape(group,value);
  return group;
}

export function updateNativeShape(group: Group, value: NativeShape) {
  const {width,height,scaleX,scaleY} = value;
  const geometry = shapeGeometry(value.shapeId,value.adjustment,width*scaleX,height*scaleY);
  const parts = geometry.paths.map(path => {
    const object = new Path(path.d, {
      fill:path.fill ? value.fill : null, stroke:path.stroke ? value.stroke : null,
      strokeWidth:value.strokeWidth, strokeUniform:true,
      strokeLineJoin:'round', strokeLineCap:'round',
      originX:'center',originY:'center',selectable:false,evented:false,
      scaleX:1/scaleX,scaleY:1/scaleY,
    });
    return {object,left:object.pathOffset.x/scaleX-width/2,top:object.pathOffset.y/scaleY-height/2};
  });
  const rect = geometry.textRect;
  const padding = Math.min(8,rect.width*0.1,rect.height*0.1);
  const label = new Textbox(value.label, {
    width:Math.max(1,rect.width-2*padding), fontSize:16, fontFamily:'IBM Plex Sans', fontWeight:500,
    splitByGrapheme:true, textAlign:'center', fill:'#263238',
    originX:'center',originY:'center',selectable:false,evented:false,
    scaleX:1/scaleX,scaleY:1/scaleY, visible:!!value.label,
  });
  while (label.fontSize > 8 && label.height > rect.height-2*padding) label.set('fontSize',label.fontSize-1);
  const children = [...parts,{object:label,left:(rect.x+rect.width/2)/scaleX-width/2,top:(rect.y+rect.height/2)/scaleY-height/2}];
  group.remove(...group.getObjects());
  group.add(...children.map(child=>child.object));
  // Group.add accepts scene coordinates; restore the intended local coordinates.
  children.forEach(({object,left,top})=>{
    object.set({left,top,scaleX:1/scaleX,scaleY:1/scaleY,angle:0,skewX:0,skewY:0,flipX:false,flipY:false});
    object.setCoords();
  });
  group.dirty = true;
}
