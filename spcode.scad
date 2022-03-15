hole_r=3;
hole_thick=0.9;
hole_pos=0.2;
base_height=2.0;
feature_height=0.2;
large=50;
width=large/4.2;
svgPath="spcode-demo.svg";
$fn=50;

difference() {
union() {
    hull () {
        translate([width*.5,width*.5,0]) cylinder(h=base_height,r=width*.5,center=true);
        translate([large-width*.5,width*.5,0]) cylinder(h=base_height,r=width*.5,center=true);
    }
    translate([0,0,base_height*.5-0.01]) resize([large*0.9,0,feature_height], auto=[false,true,false]) linear_extrude(height = feature_height+0.01, convexity = 10) import(svgPath);
    translate([hole_r*hole_pos,width*.5,0]) cylinder(h=base_height, r=hole_r, center=true);
}
    translate([hole_r*hole_pos,width*.5,0]) cylinder(h=base_height+.02, r=hole_r-hole_thick*2, center=true);
}