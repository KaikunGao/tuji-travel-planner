import type { City } from '../types'
import { beijing } from './cities/beijing'
import { chengdu } from './cities/chengdu'
import { chongqing } from './cities/chongqing'
import { xian } from './cities/xian'
import { hangzhou } from './cities/hangzhou'
import { changsha } from './cities/changsha'
import { guangzhou } from './cities/guangzhou'
import { shanghai } from './cities/shanghai'
import { xiamen } from './cities/xiamen'

/** 内置城市（按推荐顺序） */
export const BUILTIN_CITIES: City[] = [beijing, shanghai, chengdu, chongqing, xian, hangzhou, changsha, guangzhou, xiamen]

export function findBuiltinCity(id: string): City | undefined {
  return BUILTIN_CITIES.find((c) => c.id === id)
}
